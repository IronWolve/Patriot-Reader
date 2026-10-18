package app.patriotreader;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Cancellation requests retain exclusive ownership until the worker actually stops. */
final class FileOperationGate {
    static final class State {
        final String token,id,kind,username,site,phase,message;
        final long startedAt,deadlineAt;final boolean cancelRequested;
        State(String token,String id,String kind,String username,String site,String phase,String message,long startedAt,long deadlineAt,boolean cancelled){this.token=token;this.id=id;this.kind=kind;this.username=username;this.site=site;this.phase=phase;this.message=message;this.startedAt=startedAt;this.deadlineAt=deadlineAt;cancelRequested=cancelled;}
    }
    private String owner,id,kind,username,site,phase,message;
    private long startedAt,deadlineAt;private boolean cancelled,recoveryChecked,workerActive;
    private final List<Runnable> hooks=new ArrayList<>();
    synchronized boolean beginRecovery(){if(recoveryChecked)return false;recoveryChecked=true;return true;}
    synchronized String claim()throws IOException{return claim(UUID.randomUUID().toString(),"file","","",System.currentTimeMillis());}
    synchronized String claim(String operationId,String type,String user,String origin,long now)throws IOException{
        if(owner!=null)throw new IOException("A file operation is already in progress. Check its status in Downloads.");
        owner=UUID.randomUUID().toString();id=operationId;kind=type;username=user;site=origin;phase="selecting";message="Waiting for file selection.";startedAt=now;deadlineAt=0;cancelled=false;workerActive=false;hooks.clear();return owner;
    }
    synchronized void release(String token){if(owns(token)){owner=null;hooks.clear();}}
    synchronized boolean owns(String token){return token!=null&&token.equals(owner);}
    synchronized void check(String token)throws IOException{if(!owns(token))throw new IOException("This file operation is no longer active.");if(cancelled)throw new IOException(message);}
    synchronized void phase(String token,String next,long deadline)throws IOException{check(token);phase=next;workerActive=next.equals("working");deadlineAt=deadline;message=next.equals("working")?"Working on the selected file.":next.equals("confirmation")?"Waiting for your confirmation.":"Waiting for file selection.";}
    synchronized boolean abandonable(String token){return owns(token)&&!workerActive;}
    synchronized void cleanup(String token,long deadline)throws IOException{if(!owns(token))throw new IOException("This file operation is no longer active.");workerActive=true;if(!cancelled){phase="working";deadlineAt=deadline;message="Cleaning up the interrupted file operation.";}}
    synchronized State state(){return owner==null?null:new State(owner,id,kind,username,site,phase,message,startedAt,deadlineAt,cancelled);}
    synchronized List<Runnable> cancel(String operationId,String reason)throws IOException{
        if(owner==null||!id.equals(operationId))throw new IOException("That file operation is no longer active.");
        if(cancelled)return new ArrayList<>();cancelled=true;phase="canceling";message=reason;deadlineAt=0;return new ArrayList<>(hooks);
    }
    synchronized List<Runnable> expire(long now){
        if(owner==null||cancelled||deadlineAt==0||now<deadlineAt)return new ArrayList<>();
        try{return cancel(id,"The file operation reached its time limit. Cancellation was requested; waiting for the provider to stop.");}catch(IOException impossible){return new ArrayList<>();}
    }
    final class Registration implements AutoCloseable {
        private final String token;private final Runnable hook;
        Registration(String token,Runnable hook){this.token=token;this.hook=hook;}
        @Override public void close(){synchronized(FileOperationGate.this){if(owns(token))hooks.remove(hook);}}
    }
    final class Handle {
        final String token;
        Handle(String token){this.token=token;}
        void check()throws IOException{FileOperationGate.this.check(token);}
        Registration register(Runnable hook)throws IOException{synchronized(FileOperationGate.this){check();hooks.add(hook);return new Registration(token,hook);}}
    }
    Handle handle(String token){return new Handle(token);}
}
