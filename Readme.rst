Orthan server in AWS
=====================

Orthanc server https://www.orthanc-server.com/.

Features:

|uncheck| autoscaling

|uncheck| auto-recovery

|uncheck| cloudwatch logs

|uncheck| loadbalancer SSL offloading

|check| publicly accessible

|check| network security

|check| Postgres database.
https://book.orthanc-server.com/plugins/postgresql.html 

https://hub.docker.com/r/jodogne/orthanc-plugins 

Resources
----------

https://book.orthanc-server.com/users/docker.html

Infrastructure
---------------

#. vpc1 :

    #. ecs1:




Deployment
-----------

#. Set the environment variables AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_DEFAULT_REGION to appropriate values.

WIP

.. |check| unicode:: U+2611
.. |uncheck| unicode:: U+2610

